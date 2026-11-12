package demo;

class Bad {

    Bad(int a, int b, int c, int d, int e, int f, int g, int h) { // expect: J26
    }

    void plan(String a, String b, String c, String d, String e, String f, String g, String h) { // expect: J26
    }

    interface Planner {

        void plan(String a, String b, String c, String d, String e, String f, String g, String h); // expect: J26

    }

}
