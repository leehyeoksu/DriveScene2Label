package com.example.demo.nuscenes.service;
import com.example.demo.nuscenes.importer.NuscenesImporter;
import com.example.demo.nuscenes.storage.DatasetFiles;
import java.io.*;
import java.nio.file.*;
import java.time.OffsetDateTime;
import java.util.*;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.web.server.ResponseStatusException;

/** Persistent upload -> validated catalog import -> resumable keyframe image indexing. */
@Service
public class DatasetIngestionService {
 public record Job(UUID id,Long datasetId,String name,String version,String origin,String status,String stage,
   int uploadedFiles,long uploadedBytes,int totalImages,int completedImages,String errorMessage,OffsetDateTime createdAt,OffsetDateTime updatedAt) {}
 public record Coverage(long totalImages,long completedImages) {}
 private final JdbcClient jdbc; private final DatasetFiles files; private final NuscenesImporter importer;
 private final ImageEmbeddingService embeddings; private final TransactionTemplate tx;
 private final String model,preprocess; private final long maxBytes;
 public DatasetIngestionService(JdbcClient jdbc,DatasetFiles files,NuscenesImporter importer,ImageEmbeddingService embeddings,
   PlatformTransactionManager manager,@Value("${embedding.model-name}") String model,@Value("${embedding.preprocess}") String preprocess,
   @Value("${uploads.max-bytes:137438953472}") long maxBytes) {
  this.jdbc=jdbc;this.files=files;this.importer=importer;this.embeddings=embeddings;this.tx=new TransactionTemplate(manager);
  this.model=model;this.preprocess=preprocess;this.maxBytes=maxBytes;
 }
 public Job get(UUID id) { return jdbc.sql("SELECT * FROM dataset_ingestion WHERE id=:id").param("id",id).query(Job.class).optional().orElseThrow(()->bad(HttpStatus.NOT_FOUND,"작업을 찾을 수 없어요")); }
 public List<Job> list() { return jdbc.sql("SELECT * FROM dataset_ingestion ORDER BY created_at DESC LIMIT 30").query(Job.class).list(); }
 private void lock(UUID id) { jdbc.sql("SELECT id FROM dataset_ingestion WHERE id=:id FOR UPDATE").param("id",id).query(UUID.class).optional().orElseThrow(()->bad(HttpStatus.NOT_FOUND,"작업을 찾을 수 없어요")); }
 public Job create(String name,String version,String origin) {
  if(name==null || name.isBlank() || name.length()>80) throw bad(HttpStatus.BAD_REQUEST,"데이터셋 이름은 1~80자로 입력해 주세요");
  if(!Set.of("v1.0-mini","v1.0-trainval").contains(version==null?"":version)) throw bad(HttpStatus.BAD_REQUEST,"지원하는 nuScenes 버전을 선택해 주세요");
  if(!Set.of("NUSCENES","SYNTHETIC","UNKNOWN").contains(origin==null?"":origin)) throw bad(HttpStatus.BAD_REQUEST,"데이터 출처를 선택해 주세요");
  UUID id=UUID.randomUUID();
  try { Files.createDirectories(files.uploads().resolve(id.toString())); } catch(IOException e) { throw bad(HttpStatus.SERVICE_UNAVAILABLE,"업로드 저장소에 쓸 수 없어요"); }
  jdbc.sql("INSERT INTO dataset_ingestion(id,name,version,origin,status,stage) VALUES(:id,:n,:v,:o,'UPLOADING','UPLOADING')")
   .param("id",id).param("n",name.strip()).param("v",version).param("o",origin).update();
  return get(id);
 }
 public void upload(UUID id,String relative,MultipartFile file) {
  if(relative==null || relative.isBlank() || relative.length()>512 || relative.startsWith("/") || relative.contains("\\") ||
    relative.contains(":") || relative.indexOf(0)>=0 || Arrays.asList(relative.split("/",-1)).stream().anyMatch(x->x.equals("..") || x.equals(".") || x.isEmpty()))
   throw bad(HttpStatus.BAD_REQUEST,"올바른 폴더 상대 경로가 필요해요");
  if(file.isEmpty()) throw bad(HttpStatus.BAD_REQUEST,"빈 파일은 업로드할 수 없어요");
  tx.executeWithoutResult(s->{
   lock(id); Job j=get(id);
   if(!j.status().equals("UPLOADING")) throw bad(HttpStatus.CONFLICT,"이미 업로드가 확정된 작업이에요");
   Long old=jdbc.sql("SELECT size_bytes FROM dataset_upload_file WHERE ingestion_id=:id AND relative_path=:p").param("id",id).param("p",relative).query(Long.class).optional().orElse(0L);
   if(j.uploadedBytes()-old+file.getSize()>maxBytes || (old==0 && j.uploadedFiles()>=1000000)) throw bad(HttpStatus.PAYLOAD_TOO_LARGE,"데이터셋 업로드 제한을 넘었어요");
   Path root=files.uploads().resolve(id.toString()).normalize(), target=root.resolve(relative).normalize(), temp=null;
   if(!target.startsWith(root)) throw bad(HttpStatus.BAD_REQUEST,"저장 경로가 데이터 폴더 밖이에요");
   try {
    Files.createDirectories(target.getParent());
    if(!target.getParent().toRealPath().startsWith(root.toRealPath())) throw new IOException("Unsafe parent");
    temp=Files.createTempFile(root,".upload-",".tmp");
    try(InputStream in=file.getInputStream(); OutputStream out=Files.newOutputStream(temp)) { in.transferTo(out); }
    if(Files.size(temp)!=file.getSize()) throw new IOException("Incomplete upload");
    Files.move(temp,target,StandardCopyOption.REPLACE_EXISTING,StandardCopyOption.ATOMIC_MOVE);
   } catch(IOException e) { throw bad(HttpStatus.SERVICE_UNAVAILABLE,"파일을 저장하지 못했어요. 다시 업로드해 주세요"); }
   finally { if(temp!=null) try { Files.deleteIfExists(temp); } catch(IOException ignored) {} }
   jdbc.sql("INSERT INTO dataset_upload_file(ingestion_id,relative_path,size_bytes) VALUES(:id,:p,:z) ON CONFLICT(ingestion_id,relative_path) DO UPDATE SET size_bytes=EXCLUDED.size_bytes")
    .param("id",id).param("p",relative).param("z",file.getSize()).update();
   jdbc.sql("UPDATE dataset_ingestion SET uploaded_files=uploaded_files+:n,uploaded_bytes=uploaded_bytes+:z,updated_at=now() WHERE id=:id")
    .param("id",id).param("n",old==0?1:0).param("z",file.getSize()-old).update();
  });
 }
 public Job finish(UUID id,int expectedFiles) {
  tx.executeWithoutResult(s->{
   lock(id); Job j=get(id);
   if(!j.status().equals("UPLOADING")) return;
   if(expectedFiles<=0 || expectedFiles!=j.uploadedFiles()) throw bad(HttpStatus.CONFLICT,"아직 모든 파일이 저장되지 않았어요");
   for(String table:List.of("scene","sample","sample_data"))
    if(!Files.isRegularFile(files.uploads().resolve(id.toString()).resolve(j.version()).resolve(table+".json")))
     throw bad(HttpStatus.BAD_REQUEST,"선택한 폴더 안에 "+j.version()+"/"+table+".json 파일이 필요해요");
   jdbc.sql("UPDATE dataset_ingestion SET status='QUEUED',stage='IMPORTING',updated_at=now() WHERE id=:id").param("id",id).update();
  }); return get(id);
 }
 public Job index(long datasetId) {
  return tx.execute(s->{
   var ds=jdbc.sql("SELECT name,version FROM dataset WHERE id=:d FOR UPDATE").param("d",datasetId).query((r,n)->new String[]{r.getString(1),r.getString(2)}).optional()
    .orElseThrow(()->bad(HttpStatus.NOT_FOUND,"데이터셋을 찾을 수 없어요"));
   var active=jdbc.sql("SELECT * FROM dataset_ingestion WHERE dataset_id=:d AND status IN ('QUEUED','RUNNING')").param("d",datasetId).query(Job.class).optional();
   if(active.isPresent()) return active.get();
   UUID id=UUID.randomUUID();
   jdbc.sql("INSERT INTO dataset_ingestion(id,dataset_id,name,version,origin,status,stage) VALUES(:id,:d,:n,:v,'UNKNOWN','QUEUED','EMBEDDING')")
    .param("id",id).param("d",datasetId).param("n",ds[0]).param("v",ds[1]).update(); return get(id);
  });
 }
 public Job retry(UUID id) {
  tx.executeWithoutResult(s->{
   lock(id); Job j=get(id);
   if(!j.status().equals("FAILED")) throw bad(HttpStatus.CONFLICT,"실패한 작업만 다시 시작할 수 있어요");
   if(j.datasetId()!=null) {
    jdbc.sql("SELECT id FROM dataset WHERE id=:d FOR UPDATE").param("d",j.datasetId()).query(Long.class).single();
    if(jdbc.sql("SELECT count(*) FROM dataset_ingestion WHERE dataset_id=:d AND status IN ('QUEUED','RUNNING')").param("d",j.datasetId()).query(Long.class).single()>0)
     throw bad(HttpStatus.CONFLICT,"이 데이터셋의 다른 작업이 진행 중이에요");
   }
   jdbc.sql("UPDATE dataset_ingestion SET status='QUEUED',error_message=NULL,updated_at=now() WHERE id=:id").param("id",id).update();
  }); return get(id);
 }
 private static final String CAMERA = """
  FROM sample_data sd JOIN calibrated_sensor c ON c.dataset_id=sd.dataset_id AND c.token=sd.calibrated_sensor_token
  JOIN sensor se ON se.dataset_id=c.dataset_id AND se.token=c.sensor_token
  WHERE sd.dataset_id=:d AND sd.is_key_frame AND se.modality='camera'
  """;
 private static final String INDEXED = "EXISTS(SELECT 1 FROM image_embedding e WHERE e.dataset_id=sd.dataset_id AND e.sample_data_token=sd.token AND e.model_name=:m AND e.preprocess=:p)";
 public Coverage coverage(long datasetId) {
  return jdbc.sql("SELECT count(*) AS total_images,count(*) FILTER(WHERE "+INDEXED+") AS completed_images "+CAMERA)
   .param("d",datasetId).param("m",model).param("p",preprocess).query(Coverage.class).single();
 }
 public void recover() { jdbc.sql("UPDATE dataset_ingestion SET status='QUEUED',updated_at=now() WHERE status='RUNNING'").update(); }
 public void runNext() {
  var id=tx.execute(s->jdbc.sql("""
   UPDATE dataset_ingestion SET status='RUNNING',updated_at=now()
   WHERE id=(SELECT id FROM dataset_ingestion WHERE status='QUEUED' ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING id
   """).query(UUID.class).optional());
  if(id==null || id.isEmpty()) return;
  UUID jobId=id.get();
  try {
   Job j=get(jobId);
   long datasetId=j.datasetId()==null?importer.importUploaded(j.id().toString(),j.version(),j.name(),j.origin()).datasetId():j.datasetId();
   jdbc.sql("UPDATE dataset_ingestion SET dataset_id=:d,stage='EMBEDDING',updated_at=now() WHERE id=:id").param("d",datasetId).param("id",jobId).update();
   updateCounts(jobId,datasetId);
   if(coverage(datasetId).totalImages()==0) throw bad(HttpStatus.CONFLICT,"검색용 카메라 키프레임이 없어요");
   long cursor=0;
   while(true) {
    var batch=jdbc.sql("SELECT sd.id "+CAMERA+" AND sd.id>:cursor AND NOT "+INDEXED+" ORDER BY sd.id LIMIT 64")
     .param("d",datasetId).param("m",model).param("p",preprocess).param("cursor",cursor).query(Long.class).list();
    if(batch.isEmpty()) break;
    for(long fileId:batch) { embeddings.embed(fileId,false); cursor=fileId; updateCounts(jobId,datasetId); }
   }
   jdbc.sql("UPDATE dataset_ingestion SET status='COMPLETED',stage='COMPLETED',updated_at=now() WHERE id=:id").param("id",jobId).update();
  } catch(Exception e) {
   org.slf4j.LoggerFactory.getLogger(getClass()).warn("Dataset preparation {} failed",jobId,e);
   String message=e instanceof ResponseStatusException r?r.getReason():e instanceof IOException?e.getMessage():"데이터 등록에 실패했어요. nuScenes 메타데이터와 원본 파일 구성을 확인해 주세요";
   if(message==null) message="처리에 실패했어요";
   jdbc.sql("UPDATE dataset_ingestion SET status='FAILED',error_message=:e,updated_at=now() WHERE id=:id").param("id",jobId).param("e",message.substring(0,Math.min(message.length(),300))).update();
  }
 }
 private void updateCounts(UUID id,long dataset) {
  Coverage c=coverage(dataset);
  jdbc.sql("UPDATE dataset_ingestion SET total_images=:t,completed_images=:c,updated_at=now() WHERE id=:id")
   .param("id",id).param("t",c.totalImages()).param("c",c.completedImages()).update();
 }
 private static ResponseStatusException bad(HttpStatus status,String text) { return new ResponseStatusException(status,text); }
}
