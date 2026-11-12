package demo.marked;

import lombok.NonNull; // expect: J20
import org.jspecify.annotations.Nullable;
import org.springframework.lang.NonNull; // expect: J20

class Bad {

    @Nullable java.util.List<String> tags; // expect: J20

    @Nullable String[] aliases; // expect: J20

    String nickname() {
        return null; // expect: J20
    }

}
