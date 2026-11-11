package ru.mkwmusic.app;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.database.Cursor;
import android.database.MatrixCursor;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import android.provider.OpenableColumns;

import java.io.File;
import java.io.FileNotFoundException;

/** Отдаёт установщику Android скачанное обновление (только этот один файл и только на чтение). */
public class ApkProvider extends ContentProvider {
    static Uri uri(android.content.Context c) { return Uri.parse("content://" + c.getPackageName() + ".apk/update.apk"); }
    static File file(android.content.Context c) { return new File(new File(c.getCacheDir(), "upd"), "update.apk"); }

    @Override public boolean onCreate() { return true; }

    @Override
    public ParcelFileDescriptor openFile(Uri u, String mode) throws FileNotFoundException {
        if (!"update.apk".equals(u.getLastPathSegment()) || getContext() == null) throw new FileNotFoundException();
        return ParcelFileDescriptor.open(file(getContext()), ParcelFileDescriptor.MODE_READ_ONLY);
    }

    @Override public String getType(Uri u) { return "application/vnd.android.package-archive"; }

    @Override
    public Cursor query(Uri u, String[] p, String s, String[] a, String o) {
        MatrixCursor c = new MatrixCursor(new String[]{OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE});
        if (getContext() != null) c.addRow(new Object[]{"MKW-Music.apk", file(getContext()).length()});
        return c;
    }

    @Override public Uri insert(Uri u, ContentValues v) { return null; }
    @Override public int delete(Uri u, String s, String[] a) { return 0; }
    @Override public int update(Uri u, ContentValues v, String s, String[] a) { return 0; }
}
