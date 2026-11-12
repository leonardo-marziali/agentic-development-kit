package demo;

import org.springframework.data.jpa.repository.Query;

interface Bad {

    @Query(value = "SELECT * FROM project WHERE tsv @@ to_tsquery(?1)", nativeQuery = true) // expect: S50
    Object search(String text);

}
