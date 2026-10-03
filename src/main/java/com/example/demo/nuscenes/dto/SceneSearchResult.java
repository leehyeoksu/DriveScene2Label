package com.example.demo.nuscenes.dto;
public record SceneSearchResult(long sceneId, long datasetId, String sceneToken, String sceneName,
 String description, double score, double distance, long matchedImages, long contributingImages,
 long bestImageId, String bestSampleToken, String bestImagePath, String contentUrl) {}
