package com.example.demo.nuscenes.service;
import com.example.demo.nuscenes.dto.TextEmbeddingResponse;
import java.util.stream.Collectors;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;
public final class EmbeddingValidator {
 private EmbeddingValidator() {}
 public static String vector(TextEmbeddingResponse e,String model,String preprocess) {
  if(e==null || !model.equals(e.modelName()) || !preprocess.equals(e.preprocess()) || e.dimension()!=768 || e.embedding()==null || e.embedding().size()!=768) throw invalid();
  double norm=0;
  for(Double v:e.embedding()) { if(v==null || !Double.isFinite(v)) throw invalid(); norm+=v*v; }
  if(!Double.isFinite(norm) || Math.abs(norm-1)>0.001) throw invalid();
  return e.embedding().stream().map(String::valueOf).collect(Collectors.joining(",","[","]"));
 }
 private static ResponseStatusException invalid() { return new ResponseStatusException(HttpStatus.BAD_GATEWAY,"AI returned incompatible embedding metadata or vector"); }
}
