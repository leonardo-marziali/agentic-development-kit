package demo;

import jakarta.persistence.Entity;
import java.time.LocalDateTime;
import java.time.ZonedDateTime;
import java.util.Date;

@Entity
class Bad {

    private Date createdAt; // expect: S46

    private LocalDateTime updatedAt; // expect: S46

    private ZonedDateTime archivedAt; // expect: S46

}
