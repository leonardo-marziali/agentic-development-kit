package demo;

import org.springframework.beans.factory.annotation.Autowired;

class Suppressed {

    // java-rules:allow S3 legacy bean wiring, removed with the v1 API
    @Autowired
    private Object repository;

}
