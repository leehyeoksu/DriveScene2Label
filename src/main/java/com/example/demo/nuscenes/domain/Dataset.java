package com.example.demo.nuscenes.domain;
import org.springframework.data.annotation.Id;
import org.springframework.data.relational.core.mapping.Table;
@Table("dataset")
public record Dataset(
    @Id Long id,
    String name,
    String version,
    String storageKey,
    String rootRelativePath,
    String sourceChecksum
) {}
