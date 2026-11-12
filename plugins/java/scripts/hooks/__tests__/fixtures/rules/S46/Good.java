package demo;

import jakarta.persistence.Entity;
import java.time.Instant;
import java.time.LocalDate;

@Entity
class Good {

    private Instant createdAt;

    private LocalDate birthday;

}
