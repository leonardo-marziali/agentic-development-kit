package demo;

import java.util.Optional;

class Bad {

    private Optional<String> nickname; // expect: J20

    void rename(Optional<String> name) { // expect: J20
    }

}
