package com.example.demo.nuscenes.api;
import com.example.demo.nuscenes.service.DatasetIngestionService;
import java.util.*;
import org.springframework.http.*;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;
@RestController
@RequestMapping("/api")
public class DatasetIngestionController {
 private final DatasetIngestionService service;
 public DatasetIngestionController(DatasetIngestionService service) { this.service=service; }
 public record Create(String name,String version,String origin) {}
 public record Finish(int fileCount) {}
 @GetMapping("/dataset-ingestions") public List<DatasetIngestionService.Job> list() { return service.list(); }
 @PostMapping("/dataset-ingestions") @ResponseStatus(HttpStatus.CREATED)
 public DatasetIngestionService.Job create(@RequestBody Create body) { return service.create(body.name(),body.version(),body.origin()); }
 @PostMapping(value="/dataset-ingestions/{id}/files",consumes=MediaType.MULTIPART_FORM_DATA_VALUE) @ResponseStatus(HttpStatus.NO_CONTENT)
 public void upload(@PathVariable UUID id,@RequestParam String path,@RequestParam MultipartFile file) { service.upload(id,path,file); }
 @PostMapping("/dataset-ingestions/{id}/complete") @ResponseStatus(HttpStatus.ACCEPTED)
 public DatasetIngestionService.Job complete(@PathVariable UUID id,@RequestBody Finish body) { return service.finish(id,body.fileCount()); }
 @PostMapping("/dataset-ingestions/{id}/retry") @ResponseStatus(HttpStatus.ACCEPTED)
 public DatasetIngestionService.Job retry(@PathVariable UUID id) { return service.retry(id); }
 @GetMapping("/datasets/{id}/index") public DatasetIngestionService.Coverage coverage(@PathVariable long id) { return service.coverage(id); }
 @PostMapping("/datasets/{id}/index") @ResponseStatus(HttpStatus.ACCEPTED)
 public DatasetIngestionService.Job index(@PathVariable long id) { return service.index(id); }
}
