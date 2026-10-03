package com.example.demo.nuscenes.dto;
import java.util.List;
public record SceneSearchResponse(String query, String modelName, String preprocess, String aggregation,
 int imageTopK, boolean keyframesOnly, List<SceneSearchResult> scenes) {}
