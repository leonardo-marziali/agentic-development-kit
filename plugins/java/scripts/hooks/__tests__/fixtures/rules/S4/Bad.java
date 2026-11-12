package demo;

import org.springframework.beans.factory.annotation.Value;

class Bad {

    @Value("${app.timeout}") // expect: S4
    private int timeout;

    Bad(@Value("${app.name}") String name) { // expect: S4
    }

}
