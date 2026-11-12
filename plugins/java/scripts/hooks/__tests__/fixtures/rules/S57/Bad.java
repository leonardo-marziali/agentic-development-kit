package demo;

import org.springframework.web.client.RestTemplate; // expect: S57
import org.springframework.web.reactive.function.client.WebClient; // expect: S57

class Bad {
    private final RestTemplate restTemplate = new RestTemplate();
    private final WebClient webClient = WebClient.create();
}
