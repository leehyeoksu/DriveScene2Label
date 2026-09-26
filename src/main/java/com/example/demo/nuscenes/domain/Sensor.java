package com.example.demo.nuscenes.domain;
import org.springframework.data.annotation.Id;
import org.springframework.data.relational.core.mapping.Table;
@Table("sensor")
public record Sensor(
    @Id Long id,
    Long datasetId,
    String token,
    String channel,
    String modality
) {}
