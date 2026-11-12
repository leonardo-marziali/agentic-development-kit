package demo;

import java.util.HashMap;
import java.util.List;

class Bad {

    void f(List<String> names) {
        var usersById = new HashMap<Long, String>();
        var count = 3;
        var first = names.get(0); // expect: J13
        var size = names.size(); // expect: J13
    }

}
