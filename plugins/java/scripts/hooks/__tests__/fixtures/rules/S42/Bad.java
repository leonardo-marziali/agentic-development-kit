package demo;

import org.springframework.http.HttpStatus;
import org.springframework.http.ProblemDetail;

class Bad {

    ProblemDetail handle(RuntimeException exception) {
        ProblemDetail problem = ProblemDetail.forStatusAndDetail(HttpStatus.CONFLICT, exception.getMessage()); // expect: S42
        problem.setDetail("Failed: " + exception.getMessage()); // expect: S42
        return problem;
    }

}
