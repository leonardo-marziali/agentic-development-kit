package demo;

import org.springframework.beans.factory.annotation.Autowired;

class Bad {

    @Autowired // expect: S3
    private Object repository;

    @org.springframework.beans.factory.annotation.Autowired // expect: S3
    Bad(Object other) {
    }

}
