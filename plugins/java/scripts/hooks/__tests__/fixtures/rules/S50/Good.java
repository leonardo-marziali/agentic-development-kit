package demo;

import org.springframework.data.jpa.repository.Query;

interface Good {

    // Native: JPQL has no full-text search operator for PostgreSQL's tsvector.
    @Query(value = "SELECT * FROM project WHERE tsv @@ to_tsquery(?1)", nativeQuery = true)
    Object search(String text);

    @Query("SELECT p FROM ProjectEntity p WHERE p.name = ?1")
    Object byName(String name);

}
