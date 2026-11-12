package demo;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;

@RequestMapping(path = "/api/v1") // expect: S62
class Bad {

    private static final String PROJECTS = "/projects";

    @GetMapping("/projects/{projectId}") // expect: S62
    void a() {
    }

    @PostMapping("${api.v1.base-path}/projects") // expect: S62
    void b() {
    }

    @GetMapping(PROJECTS) // expect: S62
    void c() {
    }

}
