package com.example.demo.nuscenes.api;

import com.example.demo.nuscenes.dto.SceneSearchResponse;
import com.example.demo.nuscenes.service.SceneSearchService;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/search")
public class SceneSearchController {
 private final SceneSearchService service;
 public SceneSearchController(SceneSearchService service) { this.service=service; }
 @GetMapping("/scenes")
 public SceneSearchResponse scenes(@RequestParam String q, @RequestParam(defaultValue="10") int k,
   @RequestParam(required=false) Long datasetId,
   @RequestParam(defaultValue="TOP_K_AVERAGE") String aggregation,
   @RequestParam(defaultValue="3") int imageTopK,
   @RequestParam(defaultValue="true") boolean keyframesOnly) {
  return service.search(q,k,datasetId,aggregation,imageTopK,keyframesOnly);
 }
}
