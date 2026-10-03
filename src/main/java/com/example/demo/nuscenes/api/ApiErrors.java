package com.example.demo.nuscenes.api;
import org.springframework.web.bind.annotation.*;
import org.springframework.http.ResponseEntity;
import org.springframework.web.server.ResponseStatusException;
@RestControllerAdvice
public class ApiErrors {
 public record Error(String code,String message) {}
 @ExceptionHandler(ResponseStatusException.class)
 public ResponseEntity<Error> status(ResponseStatusException e) { return ResponseEntity.status(e.getStatusCode()).body(new Error("HTTP_"+e.getStatusCode().value(),e.getReason()==null?"Request failed":e.getReason())); }
 @ExceptionHandler({org.springframework.web.bind.MethodArgumentNotValidException.class,org.springframework.web.method.annotation.MethodArgumentTypeMismatchException.class,org.springframework.web.bind.MissingServletRequestParameterException.class,org.springframework.http.converter.HttpMessageNotReadableException.class})
 public ResponseEntity<Error> invalid(Exception e) { return ResponseEntity.badRequest().body(new Error("INVALID_REQUEST","Check required fields and parameter types")); }
 @ExceptionHandler({org.springframework.dao.DataAccessException.class,org.springframework.transaction.TransactionException.class})
 public ResponseEntity<Error> database(Exception e) {
  org.slf4j.LoggerFactory.getLogger(getClass()).error("Database operation failed",e);
  return ResponseEntity.status(503).body(new Error("DATABASE_UNAVAILABLE","Database operation unavailable"));
 }
}
