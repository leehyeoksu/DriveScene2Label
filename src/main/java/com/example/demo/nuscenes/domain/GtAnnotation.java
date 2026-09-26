package com.example.demo.nuscenes.domain;
import org.springframework.data.annotation.Id;
import org.springframework.data.relational.core.mapping.Table;
@Table("gt_annotation")
public record GtAnnotation(
    @Id Long id,
    Long datasetId,
    String token,
    String sampleToken,
    String instanceToken,
    String visibilityToken,
    Double centerX,
    Double centerY,
    Double centerZ,
    Double sizeW,
    Double sizeL,
    Double sizeH,
    Double rotationW,
    Double rotationX,
    Double rotationY,
    Double rotationZ,
    Integer numLidarPts,
    Integer numRadarPts,
    String prevToken,
    String nextToken
) {}
