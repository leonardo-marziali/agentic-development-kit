package demo;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;

class Good {

    @GetMapping("/projects/{projectId}/tasks/{taskId}")
    void a() {
    }

    @PostMapping("/projects/{projectId}/archival")
    void b() {
    }

    @GetMapping("/getaway-destinations")
    void c() {
    }

}
