package demo;

import jakarta.persistence.Embedded;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Version;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.Setter;

@Entity
@Getter
@Setter
class Good {

    @Id
    @Setter(AccessLevel.NONE)
    private Long id;

    @Version
    @Setter(AccessLevel.NONE)
    private long version;

    @Embedded
    @Setter(AccessLevel.NONE)
    private AuditEmbeddable audit = new AuditEmbeddable();

    private String name;

    static class AuditEmbeddable {
    }

}
