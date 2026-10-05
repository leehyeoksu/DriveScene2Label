package com.example.demo.nuscenes.dto;
import com.fasterxml.jackson.annotation.JsonInclude;
import java.time.OffsetDateTime;
import java.util.Map;
import java.util.UUID;
/** GET /api/system/status (schemaVersion 1). */
public final class SystemDtos {
 private SystemDtos() {}
 /** state: READY / CONFIGURED / UNAVAILABLE / UNKNOWN. canExecute is the only flag that allows starting work. */
 public record Capability(String state,boolean canExecute,String reasonCode,String message,OffsetDateTime checkedAt,OffsetDateTime expiresAt,
   @JsonInclude(JsonInclude.Include.NON_NULL) String executor) {}
 /** origin: SYNTHETIC / NUSCENES / UNKNOWN; mediaValidation: NOT_CHECKED / PARTIAL / VERIFIED / FAILED. */
 public record DatasetStatus(long id,String version,String origin,String metadataChecksum,String mediaValidation) {}
 public record SystemStatus(int schemaVersion,UUID instanceId,OffsetDateTime checkedAt,DatasetStatus dataset,Map<String,Capability> capabilities) {}
}
