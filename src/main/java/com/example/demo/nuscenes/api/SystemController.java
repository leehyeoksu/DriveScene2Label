package com.example.demo.nuscenes.api;
import com.example.demo.nuscenes.dto.SystemDtos.SystemStatus;
import com.example.demo.nuscenes.service.SystemStatusService;
import org.springframework.web.bind.annotation.*;
@RestController
@RequestMapping("/api/system")
public class SystemController {
 private final SystemStatusService status;
 public SystemController(SystemStatusService status) { this.status=status; }
 /** Feature readiness. refresh=true re-checks the AI runtime (read-only); it never starts work. */
 @GetMapping("/status") public SystemStatus status(@RequestParam(required=false) Long datasetId,@RequestParam(defaultValue="false") boolean refresh) {
  return status.status(datasetId,refresh);
 }
}
