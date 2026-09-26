package com.example.demo.nuscenes.domain;
import org.springframework.data.annotation.Id;
import org.springframework.data.relational.core.mapping.Table;
@Table("attribute")
public record Attribute(
    @Id Long id,
    Long datasetId,
    String token,
    String name,
    String description
) {}
