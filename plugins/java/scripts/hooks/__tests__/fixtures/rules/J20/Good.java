package demo;

import java.util.Optional;

class Good {

    private String nickname;

    Optional<String> nickname() {
        return Optional.ofNullable(nickname);
    }

}
