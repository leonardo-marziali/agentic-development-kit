package demo;

import io.swagger.v3.oas.annotations.Hidden;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;

@Hidden
@RequestMapping("/internal/getStatus")
class GoodHiddenController {

    @PostMapping("/deleteCache/{id}")
    void a() {
    }

}
