from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('monitoring', '0006_devicetestreading_device_test_latest'),
    ]

    operations = [
        migrations.AddField(
            model_name='device',
            name='reported_queue',
            field=models.PositiveIntegerField(blank=True, help_text='Records waiting on the device at its last status report (untimed records included).', null=True),
        ),
        migrations.AddField(
            model_name='device',
            name='reported_queue_capacity',
            field=models.PositiveIntegerField(blank=True, null=True),
        ),
    ]
