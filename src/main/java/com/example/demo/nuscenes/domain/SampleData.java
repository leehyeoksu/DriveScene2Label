package com.example.demo.nuscenes.domain;
import org.springframework.data.annotation.Id;
import org.springframework.data.relational.core.mapping.Table;
@Table("sample_data")
public record SampleData(
    @Id Long id,
    Long datasetId,
    String token,
    String sampleToken,
    String egoPoseToken,
    String calibratedSensorToken,
    String relativePath,
    String fileformat,
    Long timestampUs,
    Boolean isKeyFrame,
    Integer width,
    Integer height,
    String prevToken,
    String nextToken
) {}
