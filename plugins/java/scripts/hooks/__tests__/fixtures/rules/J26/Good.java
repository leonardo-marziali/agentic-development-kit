package demo;

import java.util.function.Consumer;

class Good {

    void plan(String a, String b, String c, String d, String e, String f, String g) {
    }

    void plan(Consumer<StringBuilder> request) {
    }

    record Wide(int a, int b, int c, int d, int e, int f, int g, int h) {

        Wide(int a, int b, int c, int d, int e, int f, int g, int h) {
            this.a = a;
            this.b = b;
            this.c = c;
            this.d = d;
            this.e = e;
            this.f = f;
            this.g = g;
            this.h = h;
        }

    }

    abstract static class Base {

        abstract void plan(String a, String b, String c, String d, String e, String f, String g, String h); // expect: J26

    }

    static class Child extends Base {

        @Override
        void plan(String a, String b, String c, String d, String e, String f, String g, String h) {
        }

    }

}
