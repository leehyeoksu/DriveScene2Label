package com.example.demo.nuscenes.domain;
import org.springframework.data.annotation.Id;
import org.springframework.data.relational.core.mapping.Table;
@Table("object_instance")
public record ObjectInstance(
    @Id Long id,
    Long datasetId,
    String token,
    String categoryToken,
    Integer nbrAnnotations,
    String firstAnnotationToken,
    String lastAnnotationToken
) {}
