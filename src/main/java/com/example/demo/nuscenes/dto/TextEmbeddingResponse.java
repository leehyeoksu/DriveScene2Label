package com.example.demo.nuscenes.dto;
import com.fasterxml.jackson.annotation.JsonProperty;
import java.util.List;
public record TextEmbeddingResponse(@JsonProperty("model_name") String modelName, int dimension,
 List<Double> embedding, String preprocess) {}
