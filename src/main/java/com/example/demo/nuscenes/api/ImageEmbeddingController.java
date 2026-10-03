package com.example.demo.nuscenes.api;
import com.example.demo.nuscenes.service.ImageEmbeddingService;
import org.springframework.web.bind.annotation.*;
@RestController
@RequestMapping("/api/sensor-files")
public class ImageEmbeddingController {
 private final ImageEmbeddingService service;
 public ImageEmbeddingController(ImageEmbeddingService service) { this.service=service; }
 @PostMapping("/{id}/embedding")
 public ImageEmbeddingService.Result embed(@PathVariable long id,@RequestParam(defaultValue="false") boolean overwrite) { return service.embed(id,overwrite); }
}
