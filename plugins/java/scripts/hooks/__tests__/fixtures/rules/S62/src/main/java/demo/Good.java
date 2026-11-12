package demo;

import io.swagger.v3.oas.annotations.Hidden;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;

class Good {

    @GetMapping("${api.v1.projects.id.path}")
    void a() {
    }

    @PutMapping(path = {"${api.v1.projects.id.path}"})
    void b() {
    }

    @GetMapping
    void c() {
    }

    @Hidden
    @PostMapping("${internal.api.v1.callbacks.refresh.path}")
    void d() {
    }

    @GetMapping("${api.v1.not-defined.path}")
    void e() {
    }

}
