package com.example.demo.nuscenes.domain;
import org.springframework.data.annotation.Id;
import org.springframework.data.relational.core.mapping.Table;
@Table("ego_pose")
public record EgoPose(
    @Id Long id,
    Long datasetId,
    String token,
    Long timestampUs,
    Double translationX,
    Double translationY,
    Double translationZ,
    Double rotationW,
    Double rotationX,
    Double rotationY,
    Double rotationZ
) {}
