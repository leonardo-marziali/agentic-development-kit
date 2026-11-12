package demo;

import org.springframework.beans.factory.annotation.Autowired;

class Bad {

    private int marker; // expect-next: J0
    // java-rules:allow S3
    @Autowired // expect: S3
    private Object repository;

}
