package demo;

import org.springframework.web.bind.annotation.PostMapping;

class Resolved {

    @PostMapping("${api.v1.projects.refresh.path}") // expect: S28,S30
    void a() {
    }

}
