package demo;

import io.swagger.v3.oas.annotations.Hidden;
import org.springframework.web.bind.annotation.PostMapping;

class GoodHidden {

    @Hidden
    @PostMapping("/internal/projects/{id}/recalculate/doRefresh")
    void a() {
    }

}
