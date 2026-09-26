package com.example.demo.nuscenes.domain;
import org.springframework.data.annotation.Id;
import org.springframework.data.relational.core.mapping.Table;
@Table("map_asset")
public record MapAsset(
    @Id Long id,
    Long datasetId,
    String token,
    String relativePath,
    String category
) {}
