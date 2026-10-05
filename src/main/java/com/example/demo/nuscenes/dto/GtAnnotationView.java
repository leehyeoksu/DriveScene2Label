package com.example.demo.nuscenes.dto;
/** GT annotation REST view: every gt_annotation column plus the original nuScenes category (nullable, never remapped). */
public record GtAnnotationView(Long id,Long datasetId,String token,String sampleToken,String instanceToken,String visibilityToken,
  Double centerX,Double centerY,Double centerZ,Double sizeW,Double sizeL,Double sizeH,Double rotationW,Double rotationX,Double rotationY,Double rotationZ,
  Integer numLidarPts,Integer numRadarPts,String prevToken,String nextToken,String categoryToken,String categoryName) {}
