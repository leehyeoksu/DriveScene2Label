package com.example.demo.nuscenes.api;
import org.springframework.http.HttpStatus;
/** Business error with a stable code; rendered with the existing {code,message} body (ApiErrors). */
public class CodedError extends RuntimeException {
 private final HttpStatus status; private final String code;
 public CodedError(HttpStatus status,String code,String message) { super(message); this.status=status; this.code=code; }
 public HttpStatus status() { return status; }
 public String code() { return code; }
}
