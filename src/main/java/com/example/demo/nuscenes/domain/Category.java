package com.example.demo.nuscenes.domain;
import org.springframework.data.annotation.Id;
import org.springframework.data.relational.core.mapping.Table;
@Table("category")
public record Category(
    @Id Long id,
    Long datasetId,
    String token,
    String name,
    String description
) {}
