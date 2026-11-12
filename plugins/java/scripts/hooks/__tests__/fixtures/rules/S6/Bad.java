package demo;

import org.springframework.context.annotation.Configuration;
import org.springframework.web.bind.annotation.RestController;

@Configuration
public class Bad { // expect: S6

    @RestController
    public static class Api { // expect: S6
    }

}
