package demo;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;

@RequestMapping("/api")
class Bad {

    @PostMapping("/getProjects") // expect: S28
    void a() {
    }

    @GetMapping(path = "/projects/{id}") // expect: S30
    void b() {
    }

    @PostMapping(value = {"/projects/{projectId}/archive", "/deleteProject"}) // expect: S28
    void c() {
    }

}
