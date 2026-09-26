package com.example.demo.nuscenes.domain;
import org.springframework.data.annotation.Id;
import org.springframework.data.relational.core.mapping.Table;
@Table("capture_log")
public record CaptureLog(
    @Id Long id,
    Long datasetId,
    String token,
    String logfile,
    String location,
    String dateCaptured,
    String vehicle
) {}
