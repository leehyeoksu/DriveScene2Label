package com.example.demo.nuscenes.domain;
import org.springframework.data.annotation.Id;
import org.springframework.data.relational.core.mapping.Table;
@Table("scene")
public record Scene(
    @Id Long id,
    Long datasetId,
    String token,
    String logToken,
    String name,
    String description,
    Integer nbrSamples,
    String firstSampleToken,
    String lastSampleToken
) {}
