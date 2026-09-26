package com.example.demo.nuscenes.domain;
import org.springframework.data.annotation.Id;
import org.springframework.data.relational.core.mapping.Table;
@Table("visibility")
public record Visibility(
    @Id Long id,
    Long datasetId,
    String token,
    String level,
    String description
) {}
