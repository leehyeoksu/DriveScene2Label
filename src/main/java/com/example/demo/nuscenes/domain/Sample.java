package com.example.demo.nuscenes.domain;
import org.springframework.data.annotation.Id;
import org.springframework.data.relational.core.mapping.Table;
@Table("sample")
public record Sample(
    @Id Long id,
    Long datasetId,
    String token,
    String sceneToken,
    Long timestampUs,
    String prevToken,
    String nextToken
) {}
