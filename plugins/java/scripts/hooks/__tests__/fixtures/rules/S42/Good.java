package demo;

import org.springframework.http.HttpStatus;
import org.springframework.http.ProblemDetail;

class Good {

    ProblemDetail handle(RuntimeException exception) {
        return ProblemDetail.forStatusAndDetail(HttpStatus.CONFLICT, "Project 42 is archived and can't be renamed.");
    }

}
