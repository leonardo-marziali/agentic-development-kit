package demo;

import jakarta.persistence.Embedded;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Version;
import lombok.Data;
import lombok.ToString;

@Entity
@Data // expect: S15
@ToString // expect: S15
class Bad {

    @Id // expect: S15
    private Long id;

    @Version // expect: S15
    private long version;

    @Embedded // expect: S15
    private AuditEmbeddable audit;

    private String name;

    static class AuditEmbeddable {
    }

}
